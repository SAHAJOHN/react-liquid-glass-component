type Color = readonly [number, number, number, 0 | 255]

/** A self-contained SVG and the verified geometry needed to crop its box. */
export interface NativeBorderSource {
  source: string
  width: number
  height: number
  ratio: number
  sourceWidth: number
  sourceHeight: number
  sentinelX: number
  background: Color
  border: Color
}

const maxPixels = 2_000_000
const maxDimension = 4096
const sentinelSize = 16
const sentinelBackground: Color = [12, 228, 76, 255]
const sentinelBorder: Color = [232, 40, 20, 255]
const borderStyles = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
])

function isPixelAligned(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) <= 1e-6
}

/** Computed RGB values only: no CSS tokens, variables, URLs, or markup. */
function color(value: string): Color | null {
  const input = value.trim().toLowerCase()
  if (input === 'transparent') return [0, 0, 0, 0]
  const match =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.0+)?|1(?:\.0+)?))?\s*\)$/.exec(
      input
    )
  if (!match) return null
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  if ([r, g, b].some((channel) => channel > 255)) return null
  return [r, g, b, match[4] !== undefined && Number(match[4]) === 0 ? 0 : 255]
}

function cssColor(value: Color): string {
  return `rgba(${value[0]},${value[1]},${value[2]},${value[3] / 255})`
}

/**
 * Restrict native rasterization to solid boxes with a single rounded bottom
 * border. All emitted markup is constructed from validated numeric values.
 */
export function createNativeBorderSource(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  ratio: number
): NativeBorderSource | null {
  if (
    ![width, height, ratio].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    ratio < 0.5 ||
    ratio > 2 ||
    !isPixelAligned(width * ratio) ||
    !isPixelAligned(height * ratio) ||
    Math.round(width * ratio) < 1 ||
    Math.round(height * ratio) < 1 ||
    style.backgroundImage !== 'none' ||
    style.backgroundClip !== 'border-box' ||
    (style.borderImageSource && style.borderImageSource !== 'none') ||
    style.borderTopWidth !== '0px' ||
    style.borderRightWidth !== '0px' ||
    style.borderLeftWidth !== '0px' ||
    style.borderBottomWidth !== '1px' ||
    style.borderBottomStyle !== 'solid'
  )
    return null

  // Remove sub-micro-pixel layout noise before choosing integer SVG bounds.
  width = Math.round(width * ratio) / ratio
  height = Math.round(height * ratio) / ratio

  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
  if (!radii.every((radius) => /^\d+(?:\.\d+)?px$/.test(radius))) return null
  const radius = Number.parseFloat(radii[0] ?? '')
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius * 2 > Math.min(width, height) ||
    radii.some((value) => Number.parseFloat(value) !== radius)
  )
    return null

  const background = color(style.backgroundColor)
  const border = color(style.borderBottomColor)
  const top = color(style.borderTopColor)
  const right = color(style.borderRightColor)
  const left = color(style.borderLeftColor)
  const topStyle = style.borderTopStyle.trim().toLowerCase()
  const rightStyle = style.borderRightStyle.trim().toLowerCase()
  const leftStyle = style.borderLeftStyle.trim().toLowerCase()
  if (
    !background ||
    !border ||
    !top ||
    !right ||
    !left ||
    border[3] !== 255 ||
    ![topStyle, rightStyle, leftStyle].every((value) => borderStyles.has(value))
  )
    return null

  // Integer intrinsic dimensions avoid browser-specific rounding of SVG
  // naturalWidth while retaining the original fractional box geometry.
  const sentinelX = Math.ceil(width) + 4
  const sourceWidth = sentinelX + sentinelSize + 4
  const sourceHeight = Math.max(Math.ceil(height), sentinelSize + 4)
  const backingWidth = Math.round(sourceWidth * ratio)
  const backingHeight = Math.round(sourceHeight * ratio)
  if (
    ![sourceWidth, sourceHeight, backingWidth, backingHeight].every(Number.isSafeInteger) ||
    ![
      sentinelX * ratio,
      2 * ratio,
      4 * ratio,
      sentinelSize * ratio,
      sourceWidth * ratio,
      sourceHeight * ratio,
    ].every(isPixelAligned) ||
    backingWidth > maxDimension ||
    backingHeight > maxDimension ||
    backingWidth * backingHeight > maxPixels
  )
    return null

  const boxStyle = [
    'box-sizing:border-box',
    `width:${width}px`,
    `height:${height}px`,
    `border-top:0px ${topStyle} ${cssColor(top)}`,
    `border-right:0px ${rightStyle} ${cssColor(right)}`,
    `border-bottom:1px solid ${cssColor(border)}`,
    `border-left:0px ${leftStyle} ${cssColor(left)}`,
    `border-radius:${radius}px`,
    `background:${cssColor(background)}`,
    'margin:0',
  ].join(';')
  const sentinelStyle = [
    'box-sizing:border-box',
    `width:${sentinelSize}px`,
    `height:${sentinelSize}px`,
    `background:${cssColor(sentinelBackground)}`,
    `border-bottom:4px solid ${cssColor(sentinelBorder)}`,
    'margin:0',
  ].join(';')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}"><foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="${boxStyle}"></div></foreignObject><foreignObject x="${sentinelX}" y="2" width="${sentinelSize}" height="${sentinelSize}"><div xmlns="http://www.w3.org/1999/xhtml" style="${sentinelStyle}"></div></foreignObject></svg>`
  return {
    source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
    ratio,
    sourceWidth,
    sourceHeight,
    sentinelX,
    background,
    border,
  }
}

function matchesPixel(actual: Uint8ClampedArray, expected: Color, tolerance = 6): boolean {
  return expected.every((value, index) => Math.abs((actual[index] ?? -1) - value) <= tolerance)
}

/**
 * Read back a separate XHTML sentinel before trusting foreignObject output.
 * Blank/tainted images and unsupported 2D contexts preserve native fallback.
 */
export function paintNativeBorder(
  image: HTMLImageElement,
  spec: NativeBorderSource
): HTMLCanvasElement | null {
  if (image.naturalWidth !== spec.sourceWidth || image.naturalHeight !== spec.sourceHeight)
    return null
  try {
    const scratch = document.createElement('canvas')
    scratch.width = Math.round(spec.sourceWidth * spec.ratio)
    scratch.height = Math.round(spec.sourceHeight * spec.ratio)
    const context = scratch.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, spec.sourceWidth * spec.ratio, spec.sourceHeight * spec.ratio)
    const read = (x: number, y: number) =>
      context.getImageData(Math.floor(x * spec.ratio), Math.floor(y * spec.ratio), 1, 1).data
    const sentinelOk =
      matchesPixel(read(spec.sentinelX + 8, 6), sentinelBackground) &&
      matchesPixel(read(spec.sentinelX + 8, 16), sentinelBorder)
    if (!sentinelOk) return null
    const center = read(spec.width / 2, spec.height / 2)
    const bottom = read(spec.width / 2, spec.height - 0.5)
    const contrast = Math.max(
      ...spec.border
        .slice(0, 3)
        .map((channel, index) => Math.abs(channel - (spec.background[index] ?? 0)))
    )
    const bottomDifference = Math.max(
      ...spec.background
        .slice(0, 3)
        .map((channel, index) => Math.abs(channel - (bottom[index] ?? 0)))
    )
    if (
      !matchesPixel(center, spec.background) ||
      (bottom[3] ?? 0) === 0 ||
      (spec.background[3] === 255 && contrast > 8 && bottomDifference < 2)
    )
      return null

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(spec.width * spec.ratio)
    canvas.height = Math.round(spec.height * spec.ratio)
    const output = canvas.getContext('2d')
    if (!output) return null
    output.drawImage(scratch, 0, 0)
    return canvas
  } catch {
    return null
  }
}

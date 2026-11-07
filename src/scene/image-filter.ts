/** A color-only image filter whose result is independent of pixel position. */
export type SupportedImageFilter = 'brightness(0) invert(1)'

/**
 * Recognize a deliberately narrow, geometry-preserving filter chain. The
 * browser's computed style may express the same values as percentages.
 */
export function inspectImageFilter(value: string): SupportedImageFilter | null {
  const match =
    /^\s*brightness\(\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)%?)\s*\)\s+invert\(\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)%?)\s*\)\s*$/i.exec(
      value
    )
  if (!match?.[1] || !match[2]) return null
  const normalized = (part: string) => Number.parseFloat(part) / (part.endsWith('%') ? 100 : 1)
  return normalized(match[1]) === 0 && normalized(match[2]) === 1 ? 'brightness(0) invert(1)' : null
}

/**
 * The supported filter turns all source colors white while preserving alpha.
 * `source-in` implements that operation without Canvas 2D filter support or
 * reading pixels. An origin-tainted source taints the result; callers must
 * retain their existing origin checks before uploading it to WebGL.
 */
export function paintImageFilter(
  source: HTMLCanvasElement,
  filter: SupportedImageFilter
): HTMLCanvasElement | null {
  const { width, height } = source
  if (
    filter !== 'brightness(0) invert(1)' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 2_000_000
  )
    return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.globalCompositeOperation = 'source-in'
    if (context.globalCompositeOperation !== 'source-in') return null
    context.globalCompositeOperation = 'source-over'
    context.drawImage(source, 0, 0)
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    return canvas
  } catch {
    return null
  }
}

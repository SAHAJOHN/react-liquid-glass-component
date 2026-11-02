import type { SceneRect } from './types'

export type EllipsisPaint =
  | { status: 'none' }
  | { status: 'unsupported'; reason: string }
  | { status: 'ready'; bitmap: HTMLCanvasElement; rect: SceneRect; text: string }

interface CachedEllipsis {
  key: string
  bitmap: HTMLCanvasElement
  text: string
}

const bitmapCache = new WeakMap<HTMLElement, CachedEllipsis>()
const fontVersions = new WeakMap<FontFaceSet, { id: number; version: number }>()
let nextFontSetId = 1

function fontVersion(fonts: FontFaceSet): string {
  let state = fontVersions.get(fonts)
  if (!state) {
    state = { id: nextFontSetId++, version: 0 }
    const current = state
    const invalidate = () => current.version++
    fonts.addEventListener('loading', invalidate)
    fonts.addEventListener('loadingdone', invalidate)
    fonts.addEventListener('loadingerror', invalidate)
    fontVersions.set(fonts, state)
  }
  return `${state.id}:${state.version}`
}

/** Split at grapheme boundaries so truncation never cuts Thai marks or emoji sequences. */
export function graphemes(text: string): string[] | null {
  const constructor: unknown = Reflect.get(Intl, 'Segmenter')
  if (typeof constructor !== 'function') return null
  try {
    const segmenter: unknown = Reflect.construct(constructor, [
      undefined,
      { granularity: 'grapheme' },
    ])
    if (!segmenter || typeof segmenter !== 'object' || !('segment' in segmenter)) return null
    if (typeof segmenter.segment !== 'function') return null
    const parts: unknown = Reflect.apply(segmenter.segment, segmenter, [text])
    if (!parts || typeof parts !== 'object' || !(Symbol.iterator in parts)) return null
    const iterator = parts[Symbol.iterator]
    if (typeof iterator !== 'function') return null
    const items: unknown[] = Array.from(parts as Iterable<unknown>)
    const result: string[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object' || !('segment' in item)) return null
      if (typeof item.segment !== 'string') return null
      result.push(item.segment)
    }
    return result.join('') === text ? result : null
  } catch {
    return null
  }
}

/** Return the longest grapheme-safe prefix with an ellipsis that fits the content box. */
export function fitEllipsis(
  text: string,
  available: number,
  measure: (text: string) => number
): string | null {
  if (!Number.isFinite(available) || available < 0) return null
  const full = measure(text)
  if (!Number.isFinite(full)) return null
  if (full <= available) return text
  const ellipsisWidth = measure('…')
  if (!Number.isFinite(ellipsisWidth) || ellipsisWidth > available) return null
  const parts = graphemes(text)
  if (!parts || parts.length > 4096) return null
  let prefix = ''
  for (const part of parts) {
    const next = prefix + part
    const width = measure(`${next}…`)
    if (!Number.isFinite(width)) return null
    if (width > available) break
    prefix = next
  }
  return `${prefix}…`
}

const isNormal = (value: string | undefined) => !value || value === 'normal' || value === 'none'
const isZero = (value: string | undefined) => isNormal(value) || value === '0px' || value === '0'

function translationOnly(value: string): boolean {
  if (isNormal(value)) return true
  try {
    const matrix = new DOMMatrixReadOnly(value)
    return (
      matrix.is2D &&
      Math.abs(matrix.a - 1) < 0.000001 &&
      Math.abs(matrix.d - 1) < 0.000001 &&
      Math.abs(matrix.b) < 0.000001 &&
      Math.abs(matrix.c) < 0.000001
    )
  } catch {
    return false
  }
}

/** Render a narrowly supported native single-line ellipsis into a transparent sprite. */
export function paintEllipsis(element: HTMLElement, ratio: number): EllipsisPaint {
  const style = getComputedStyle(element)
  if (
    style.display === 'none' ||
    style.visibility !== 'visible' ||
    style.textOverflow !== 'ellipsis' ||
    element.scrollWidth <= element.clientWidth
  )
    return { status: 'none' }
  const unsupported = (reason: string): EllipsisPaint => ({ status: 'unsupported', reason })
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  )
    return unsupported('Editable ellipsis requires native HTML rendering')
  if (
    style.direction !== 'ltr' ||
    style.writingMode !== 'horizontal-tb' ||
    style.whiteSpace !== 'nowrap' ||
    !['hidden', 'clip'].includes(style.overflowX) ||
    !['left', 'start'].includes(style.textAlign)
  )
    return unsupported('Unsupported ellipsis layout')
  if (
    !isZero(style.textIndent) ||
    !isZero(style.wordSpacing) ||
    !isNormal(style.textDecorationLine) ||
    !isNormal(style.textShadow) ||
    !isNormal(style.fontVariant) ||
    !isNormal(style.fontFeatureSettings) ||
    !isNormal(style.fontVariationSettings) ||
    !['normal', '100%', ''].includes(style.fontStretch) ||
    !['none', ''].includes(style.textTransform)
  )
    return unsupported('Unsupported ellipsis text styling')
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const ancestorStyle = ancestor === element ? style : getComputedStyle(ancestor)
    if (
      !translationOnly(ancestorStyle.transform) ||
      !isNormal(ancestorStyle.translate) ||
      !isNormal(ancestorStyle.rotate) ||
      !isNormal(ancestorStyle.scale) ||
      !isNormal(ancestorStyle.perspective) ||
      (ancestorStyle.zoom && !['normal', '1'].includes(ancestorStyle.zoom))
    )
      return unsupported('Transformed ellipsis requires native HTML rendering')
  }
  const nodes = Array.from(element.childNodes)
  if (
    !nodes.some((node) => node instanceof Text) ||
    nodes.some((node) => !(node instanceof Text || node instanceof Comment))
  )
    return unsupported('Nested ellipsis content requires native HTML rendering')
  // Separate text runs may shape or kern differently when their boundary is
  // inside a word. A single canvas text run is only safe at a space boundary.
  const runs = nodes.filter((node): node is Text => node instanceof Text && node.data.length > 0)
  let previousRun = ''
  for (const run of runs) {
    if (previousRun && !/[\t\n\f\r ]$/.test(previousRun) && !/^[\t\n\f\r ]/.test(run.data))
      return unsupported('Adjacent text runs require native HTML rendering')
    previousRun = run.data
  }
  // innerText applies the browser's whitespace collapsing across React comment
  // boundaries while retaining the rendered text rather than its ellipsis.
  const text = element.innerText
  if (
    typeof text !== 'string' ||
    !text ||
    /[\t\n\f\r]|[\u0590-\u08ff\u202a-\u202e\u2066-\u2069]/u.test(text)
  )
    return unsupported('Unsupported ellipsis text')
  if (!Number.isFinite(ratio) || ratio <= 0) return unsupported('Invalid ellipsis raster ratio')
  const box = element.getBoundingClientRect()
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingRight = Number.parseFloat(style.paddingRight) || 0
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const width = element.clientWidth - paddingLeft - paddingRight
  const height = element.clientHeight - paddingTop - paddingBottom
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return unsupported('Invalid ellipsis content box')
  const range = document.createRange()
  range.selectNodeContents(element)
  const textBounds = range.getBoundingClientRect()
  const x = box.left + borderLeft + paddingLeft
  const y = box.top + borderTop + paddingTop
  if (Math.abs(textBounds.left - x) > 1 || textBounds.height <= 0)
    return unsupported('Unsupported ellipsis text position')
  const boundedRatio = Math.min(
    ratio,
    4096 / width,
    4096 / height,
    Math.sqrt(2_000_000 / (width * height))
  )
  const pixelWidth = Math.max(1, Math.ceil(width * boundedRatio))
  const pixelHeight = Math.max(1, Math.ceil(height * boundedRatio))
  if (pixelWidth > 4096 || pixelHeight > 4096 || pixelWidth * pixelHeight > 2_000_000)
    return unsupported('Ellipsis raster exceeds safe size')
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const fonts = document.fonts
  const version = fonts ? fontVersion(fonts) : 'none'
  if (fonts && fonts.status !== 'loaded') return unsupported('Ellipsis font is not ready')
  // Some browsers report false if an unused fallback face in the font stack
  // has not loaded. Compare the actual DOM and canvas text widths below in that
  // case instead of waiting forever for a face the browser did not need.
  const fontStackReady = !fonts || fonts.check(font, text)
  const letterSpacing = isZero(style.letterSpacing) ? '0px' : style.letterSpacing
  const key = JSON.stringify([
    text,
    width,
    height,
    boundedRatio,
    textBounds.top - y,
    font,
    style.color,
    letterSpacing,
    version,
    fontStackReady ? null : textBounds.width,
  ])
  const previous = bitmapCache.get(element)
  if (previous?.key === key)
    return {
      status: 'ready',
      bitmap: previous.bitmap,
      rect: { x, y, width, height },
      text: previous.text,
    }
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return unsupported('Ellipsis canvas unavailable')
  context.scale(boundedRatio, boundedRatio)
  context.font = font
  if (letterSpacing !== '0px' && !('letterSpacing' in context))
    return unsupported('Ellipsis letter spacing requires native HTML rendering')
  if ('letterSpacing' in context) context.letterSpacing = letterSpacing
  context.direction = 'ltr'
  context.fillStyle = style.color
  context.textBaseline = 'alphabetic'
  if (!fontStackReady) {
    const measuredWidth = context.measureText(text).width
    if (
      !Number.isFinite(measuredWidth) ||
      !Number.isFinite(textBounds.width) ||
      Math.abs(measuredWidth - textBounds.width) > 1 ||
      (fonts && fonts.status !== 'loaded')
    )
      return unsupported('Ellipsis font is not ready')
  }
  const metrics = context.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  if (!Number.isFinite(ascent)) return unsupported('Ellipsis font metrics unavailable')
  const fitted = fitEllipsis(text, width, (value) => context.measureText(value).width)
  if (fitted === null || fitted === text) return unsupported('Ellipsis text could not be fitted')
  context.save()
  context.beginPath()
  context.rect(0, 0, width, height)
  context.clip()
  context.fillText(fitted, 0, textBounds.top - y + ascent)
  context.restore()
  // Canvas text measurement/painting may itself trigger a delayed fallback
  // face. Do not cache the interim bitmap while that face is loading.
  if (fonts && fonts.status !== 'loaded') return unsupported('Ellipsis font is not ready')
  bitmapCache.set(element, { key, bitmap: canvas, text: fitted })
  return { status: 'ready', bitmap: canvas, rect: { x, y, width, height }, text: fitted }
}

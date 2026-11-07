import { paintGradient, splitCss } from './paint-box'
import { paintText, type TextPaintOptions } from './paint-content'
import type { SceneRect } from './types'

interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

type GradientEffect = { kind: 'gradient'; image: string; insets: Insets }
type ShadowEffect = {
  kind: 'shadow'
  shadow: { color: string; x: number; y: number; blur: number }
  fill: string
  insets: Insets
}
type StrokeEffect = {
  kind: 'stroke'
  stroke: { color: string; width: number }
  fill: string
  insets: Insets
}
export type SupportedTextEffect = GradientEffect | ShadowEffect | StrokeEffect
export type TextEffectInspection = SupportedTextEffect | { kind: 'none' } | { kind: 'unsupported' }

function value(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim()
}

function absent(input: string, initial: string): boolean {
  return !input || input === initial
}

function color(input: string): boolean {
  try {
    return !!input && typeof CSS !== 'undefined' && CSS.supports('color', input)
  } catch {
    return false
  }
}

function singleTextLeaf(element: HTMLElement): boolean {
  let found = 0
  for (const child of element.childNodes) {
    if (child instanceof Text) {
      if (child.data.trim()) found += 1
    } else if (child instanceof Element) return false
  }
  if (found !== 1) return false
  try {
    for (const name of ['::before', '::after']) {
      const content = getComputedStyle(element, name).content
      if (content && content !== 'none' && content !== 'normal') return false
    }
  } catch {
    return false
  }
  return true
}

function parseShadow(input: string): ShadowEffect['shadow'] | null {
  const parts = splitCss(input)
  if (parts.length !== 1) return null
  const tokens = parts[0]?.match(/[^\s(]+\([^)]*\)|[^\s]+/g) ?? []
  const lengths = tokens.filter((part) => /^-?(?:\d+\.?\d*|\.\d+)px$/.test(part))
  const colors = tokens.filter((part) => !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(part))
  if (lengths.length < 2 || lengths.length > 3 || colors.length !== 1 || !color(colors[0] ?? ''))
    return null
  const [x = NaN, y = NaN, blur = 0] = lengths.map(Number.parseFloat)
  if (
    ![x, y, blur].every(Number.isFinite) ||
    Math.abs(x) > 128 ||
    Math.abs(y) > 128 ||
    blur < 0 ||
    blur > 64
  )
    return null
  return { color: colors[0] ?? '', x, y, blur }
}

/**
 * Recognize only single-leaf text effects whose entire paint is reproducible in a bounded bitmap.
 * Callers must retain native fallback for `unsupported` and draw a gradient-clipped box only as
 * text, never as an ordinary background. The effect is never inferred from an ancestor.
 */
export function inspectTextEffect(
  element: HTMLElement,
  style: CSSStyleDeclaration
): TextEffectInspection {
  const clip = value(style, 'background-clip') || style.backgroundClip
  const shadow = value(style, 'text-shadow') || style.textShadow
  const widthValue = value(style, '-webkit-text-stroke-width')
  const width = widthValue ? Number.parseFloat(widthValue) : 0
  const hasGradient = clip === 'text'
  const hasShadow = !!shadow && shadow !== 'none'
  const hasStroke = !!widthValue && Number.isFinite(width) && width > 0
  if (!hasGradient && !hasShadow && !hasStroke) {
    return widthValue && (!Number.isFinite(width) || width < 0)
      ? { kind: 'unsupported' }
      : { kind: 'none' }
  }
  if (
    Number(hasGradient) + Number(hasShadow) + Number(hasStroke) !== 1 ||
    !singleTextLeaf(element) ||
    !absent(value(style, 'text-decoration-line'), 'none') ||
    !absent(value(style, 'text-emphasis-style'), 'none') ||
    !absent(value(style, 'background-attachment'), 'scroll')
  )
    return { kind: 'unsupported' }
  const fill = value(style, '-webkit-text-fill-color') || style.color
  const fontSize = Number.parseFloat(value(style, 'font-size') || style.fontSize)
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 256) return { kind: 'unsupported' }
  // Room for glyph overhang as well as subpixel antialiasing. Very unusual
  // fonts can exceed an em, so callers should retain a native fallback for
  // untrusted or explicitly overflowing text.
  const glyphInset = Math.ceil(fontSize + 2)
  if (hasGradient) {
    const image = value(style, 'background-image') || style.backgroundImage
    const bg = value(style, 'background-color') || style.backgroundColor
    if (
      !/^linear-gradient\(/.test(image) ||
      splitCss(image).length !== 1 ||
      !/^(?:transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(fill) ||
      !/^(?:transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(bg) ||
      !['', 'auto', 'auto auto'].includes(value(style, 'background-size')) ||
      !['', '0% 0%', '0px 0px'].includes(value(style, 'background-position')) ||
      !['', 'repeat'].includes(value(style, 'background-repeat')) ||
      !['', 'padding-box'].includes(value(style, 'background-origin')) ||
      ['top', 'right', 'bottom', 'left'].some((side) =>
        [value(style, `padding-${side}`), value(style, `border-${side}-width`)].some(
          (part) => !!part && Number.parseFloat(part) !== 0
        )
      )
    )
      return { kind: 'unsupported' }
    return {
      kind: 'gradient',
      image,
      insets: { left: glyphInset, top: glyphInset, right: glyphInset, bottom: glyphInset },
    }
  }
  if (!color(fill)) return { kind: 'unsupported' }
  if (hasShadow) {
    const parsed = parseShadow(shadow)
    if (!parsed) return { kind: 'unsupported' }
    const radius = Math.ceil(parsed.blur * 2 + glyphInset)
    return {
      kind: 'shadow',
      shadow: parsed,
      fill,
      insets: {
        left: Math.max(glyphInset, radius - parsed.x),
        top: Math.max(glyphInset, radius - parsed.y),
        right: Math.max(glyphInset, radius + parsed.x),
        bottom: Math.max(glyphInset, radius + parsed.y),
      },
    }
  }
  const strokeColor = value(style, '-webkit-text-stroke-color')
  if (!/^\d+(?:\.\d+)?px$/.test(widthValue) || width > 32 || !color(strokeColor))
    return { kind: 'unsupported' }
  const inset = Math.ceil(width / 2 + glyphInset)
  return {
    kind: 'stroke',
    stroke: { width, color: strokeColor },
    fill,
    insets: { left: inset, top: inset, right: inset, bottom: inset },
  }
}

/** Fit the padded bitmap into the same texture and pixel limits as scene text. */
export function textEffectRasterRatio(
  bounds: DOMRect,
  scaleX: number,
  scaleY: number,
  pixelRatio: number,
  effect: SupportedTextEffect
): number | null {
  const { left, top, right, bottom } = effect.insets
  const width = bounds.width / scaleX + left + right
  const height = bounds.height / scaleY + top + bottom
  if (
    ![bounds.width, bounds.height, scaleX, scaleY, pixelRatio, width, height].every(
      Number.isFinite
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    pixelRatio <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return null
  // Rounding the backing dimensions up must not push the bitmap over its limit.
  const maxDimension = 4095
  const maxPixels = 1_995_000
  return Math.min(
    pixelRatio,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height))
  )
}

export interface TextEffectGeometry {
  rect: SceneRect
  cacheKey: string
  gradient?: { offsetX: number; offsetY: number; width: number; height: number }
}

/** Measure a bounded effect and a stable bitmap key before performing any canvas allocation. */
export function textEffectGeometry(
  bounds: DOMRect,
  owner: HTMLElement,
  ratio: number,
  scaleX: number,
  scaleY: number,
  effect: SupportedTextEffect
): TextEffectGeometry | null {
  if (
    ![bounds.left, bounds.top, bounds.width, bounds.height, ratio, scaleX, scaleY].every(
      Number.isFinite
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    ratio <= 0 ||
    scaleX <= 0 ||
    scaleY <= 0
  )
    return null
  const inset = effect.insets
  const width = Math.ceil((bounds.width / scaleX + inset.left + inset.right) * ratio)
  const height = Math.ceil((bounds.height / scaleY + inset.top + inset.bottom) * ratio)
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 2_000_000)
    return null
  let gradient: TextEffectGeometry['gradient']
  if (effect.kind === 'gradient') {
    const ownerRect = owner.getBoundingClientRect()
    if (
      ![ownerRect.left, ownerRect.top, ownerRect.width, ownerRect.height].every(Number.isFinite) ||
      ownerRect.width <= 0 ||
      ownerRect.height <= 0
    )
      return null
    gradient = {
      offsetX: (ownerRect.left - bounds.left) / scaleX + inset.left,
      offsetY: (ownerRect.top - bounds.top) / scaleY + inset.top,
      width: ownerRect.width / scaleX,
      height: ownerRect.height / scaleY,
    }
  }
  return {
    rect: {
      x: bounds.left - inset.left * scaleX,
      y: bounds.top - inset.top * scaleY,
      width: bounds.width + (inset.left + inset.right) * scaleX,
      height: bounds.height + (inset.top + inset.bottom) * scaleY,
    },
    cacheKey: `${JSON.stringify(effect)}|${JSON.stringify(gradient)}`,
    ...(gradient ? { gradient } : {}),
  }
}

/** Produce the bitmap for an already-inspected text effect, or null if painting fails. */
export function paintTextEffect(
  node: Text,
  bounds: DOMRect,
  owner: HTMLElement,
  style: CSSStyleDeclaration,
  ratio: number,
  scaleX: number,
  scaleY: number,
  effect: SupportedTextEffect
): { bitmap: HTMLCanvasElement; rect: SceneRect; cacheKey: string } | null {
  const geometry = textEffectGeometry(bounds, owner, ratio, scaleX, scaleY, effect)
  if (!geometry) return null
  const options: TextPaintOptions = {
    insets: effect.insets,
    verifyBounds: true,
    fill: effect.kind === 'gradient' ? '#fff' : effect.fill,
    ...(effect.kind === 'shadow' ? { shadow: effect.shadow } : {}),
    ...(effect.kind === 'stroke' ? { stroke: effect.stroke } : {}),
  }
  try {
    const bitmap = paintText(node, bounds, style, ratio, scaleX, scaleY, options)
    if (effect.kind === 'gradient') {
      const context = bitmap.getContext('2d')
      const gradient = geometry.gradient
      if (!context || !gradient) return null
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.globalCompositeOperation = 'source-in'
      context.translate(gradient.offsetX, gradient.offsetY)
      if (!paintGradient(context, effect.image, gradient.width, gradient.height)) return null
    }
    return { bitmap, rect: geometry.rect, cacheKey: geometry.cacheKey }
  } catch {
    return null
  }
}

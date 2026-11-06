import { paintGradient, splitCss } from './paint-box'

/**
 * Rasterize a single, border-box-sized alpha gradient mask.
 *
 * The caller must apply the element's border radius and inherited clips and
 * reject any geometry it cannot represent, including unsupported transforms.
 * A null result means that native rendering is still required.
 */
export function paintBackdropMask(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
  ratio: number
): HTMLCanvasElement | null {
  if (
    ![width, height, ratio].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    ratio <= 0 ||
    Math.ceil(width * ratio) > 4096 ||
    Math.ceil(height * ratio) > 4096 ||
    Math.ceil(width * ratio) * Math.ceil(height * ratio) > 2_000_000
  )
    return null

  const property = (name: string) => style.getPropertyValue(name).trim().toLowerCase()
  const standardImage = property('mask-image')
  const webkitImage = property('-webkit-mask-image')
  const image = standardImage || webkitImage
  if (
    !image ||
    (standardImage && webkitImage && standardImage !== webkitImage) ||
    !safeLinearGradient(image)
  )
    return null

  const isOneOf = (name: string, values: readonly string[]) => {
    const value = property(name)
    return !value || values.includes(value)
  }
  if (
    !isOneOf('mask-mode', ['match-source', 'alpha']) ||
    !isOneOf('mask-position', ['0% 0%', '0px 0%', '0% 0px', '0px 0px']) ||
    !isOneOf('-webkit-mask-position', ['0% 0%', '0px 0%', '0% 0px', '0px 0px']) ||
    !isOneOf('mask-size', ['auto', '100% 100%']) ||
    !isOneOf('-webkit-mask-size', ['auto', '100% 100%']) ||
    !isOneOf('mask-repeat', ['repeat', 'no-repeat']) ||
    !isOneOf('-webkit-mask-repeat', ['repeat', 'no-repeat']) ||
    !isOneOf('mask-origin', ['border-box']) ||
    !isOneOf('-webkit-mask-origin', ['border-box']) ||
    !isOneOf('mask-clip', ['border-box']) ||
    !isOneOf('-webkit-mask-clip', ['border-box']) ||
    !isOneOf('mask-composite', ['add']) ||
    !isOneOf('-webkit-mask-composite', ['add', 'source-over']) ||
    !isOneOf('mask-border-source', ['none']) ||
    !isOneOf('-webkit-mask-box-image-source', ['none'])
  )
    return null

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * ratio)
  canvas.height = Math.ceil(height * ratio)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return paintGradient(context, image, width, height) ? canvas : null
}

/** Keep paintGradient's stop clamping from changing out-of-range gradients. */
function safeLinearGradient(image: string): boolean {
  const match = /^linear-gradient\((.*)\)$/.exec(image)
  if (!match?.[1]) return false
  const parts = splitCss(match[1])
  const first = parts[0] ?? ''
  if (
    /^(?:to (?:left|right|top|bottom|top left|top right|bottom left|bottom right|left top|right top|left bottom|right bottom)|-?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|rad|turn|grad))$/.test(
      first
    )
  )
    parts.shift()
  if (parts.length < 2) return false
  return parts.every((part) => {
    const stop = /^(.*?)(?:\s+(-?[\d.]+%))?(?:\s+(-?[\d.]+%))?$/.exec(part)
    if (
      !stop?.[1] ||
      /\b(?:currentcolor|var\s*\()/.test(stop[1]) ||
      !CSS.supports('color', stop[1].trim())
    )
      return false
    return [stop[2], stop[3]].every((value) => {
      if (!value) return true
      const offset = Number.parseFloat(value)
      return Number.isFinite(offset) && offset >= 0 && offset <= 100
    })
  })
}

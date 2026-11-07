import { boxRadii, positionValue, roundedPath } from './paint-box'

export interface Asset {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'error'
}
const MAX_RETAINED_ASSETS = 256
const MAX_PRIMED_ASSETS = 32
const MAX_PRIMED_PIXELS = 2_000_000
const MAX_TOTAL_PRIMED_PIXELS = 8_000_000

export function stableSvgRasterDimension(value: number): number {
  return Number(value.toFixed(3))
}

export function canReuseLoadedImage(image: HTMLImageElement, source: string): boolean {
  if (!image.complete || image.naturalWidth <= 0) return false
  if (source.startsWith('data:') || source.startsWith('blob:')) return true
  try {
    return (
      new URL(source, document.baseURI).origin === location.origin ||
      image.crossOrigin === 'anonymous'
    )
  } catch {
    return false
  }
}

export function createAssetCache(invalidate: () => void) {
  interface CachedAsset extends Asset {
    /** Whether the current scene has waited for this image. */
    demanded: boolean
    /** Speculatively decoded copies have a separate, smaller budget. */
    primed: boolean
    primedPixels: number
  }
  const assets = new Map<string, CachedAsset>()
  let disposed = false
  let primedCount = 0
  let primedPixels = 0
  const used = new Set<string>()
  const releasePrime = (asset: CachedAsset) => {
    if (!asset.primed) return
    primedCount -= 1
    primedPixels -= asset.primedPixels
    asset.primed = false
    asset.primedPixels = 0
  }
  const create = (source: string, demanded: boolean, reservedPixels = 0): CachedAsset => {
    const image = new Image()
    const asset: CachedAsset = {
      image,
      status: 'loading',
      demanded,
      primed: !demanded,
      primedPixels: demanded ? 0 : reservedPixels,
    }
    image.onload = () => {
      if (disposed || assets.get(source) !== asset) return
      if (asset.primed) {
        const actualPixels = image.naturalWidth * image.naturalHeight
        const exceedsBudget =
          !actualPixels ||
          image.naturalWidth > 4096 ||
          image.naturalHeight > 4096 ||
          actualPixels > MAX_PRIMED_PIXELS ||
          primedPixels - asset.primedPixels + actualPixels > MAX_TOTAL_PRIMED_PIXELS
        if (exceedsBudget) {
          // A mutable URL can return a different-sized image than the DOM
          // source used for the reservation. A demanded image is required by
          // the current scene; a purely speculative one is discarded.
          releasePrime(asset)
          if (!asset.demanded) {
            asset.status = 'error'
            image.onload = null
            image.onerror = null
            image.removeAttribute('src')
            return
          }
        } else {
          primedPixels += actualPixels - asset.primedPixels
          asset.primedPixels = actualPixels
        }
      }
      asset.status = 'ready'
      if (asset.demanded) invalidate()
    }
    image.onerror = () => {
      if (disposed || assets.get(source) !== asset) return
      asset.status = 'error'
      releasePrime(asset)
      if (asset.demanded) invalidate()
    }
    if (!source.startsWith('data:') && !source.startsWith('blob:')) image.crossOrigin = 'anonymous'
    assets.set(source, asset)
    if (asset.primed) {
      primedCount += 1
      primedPixels += asset.primedPixels
    }
    image.src = source
    return asset
  }
  const remove = (source: string, asset: CachedAsset) => {
    asset.image.onload = null
    asset.image.onerror = null
    assets.delete(source)
    releasePrime(asset)
  }
  const touch = (source: string, asset: CachedAsset) => {
    assets.delete(source)
    assets.set(source, asset)
  }
  return {
    begin() {
      used.clear()
    },
    end() {
      // Keep recently used decoded assets across visibility animations. Removing
      // an inline SVG as soon as an opacity-zero ancestor skips it forces a new
      // asynchronous Image decode when it reappears, which would make the whole
      // scene fall back for a frame. Evict unused least-recently-used assets
      // above the target; assets used by this compilation remain available.
      for (const [source, asset] of assets) {
        if (assets.size <= MAX_RETAINED_ASSETS || used.has(source)) continue
        remove(source, asset)
      }
    },
    get(source: string): Asset {
      used.add(source)
      const previous = assets.get(source)
      if (previous) {
        // A failed speculative request must not poison a later required load.
        if (previous.status === 'error' && !previous.demanded) {
          remove(source, previous)
        } else {
          previous.demanded = true
          // A required image belongs to the active scene, not the speculative
          // warm budget, even if its background request has not finished yet.
          releasePrime(previous)
          touch(source, previous)
          return previous
        }
      }
      return create(source, true)
    },
    /** Warm an independent image only after the DOM image passed its origin-clean check. */
    prime(source: string, width: number, height: number): void {
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 4096 ||
        height > 4096 ||
        width * height > MAX_PRIMED_PIXELS
      )
        return
      used.add(source)
      const previous = assets.get(source)
      if (previous?.status === 'error' && previous.demanded) {
        remove(source, previous)
      } else if (previous) {
        touch(source, previous)
        return
      }
      const pixels = width * height
      while (primedCount >= MAX_PRIMED_ASSETS || primedPixels + pixels > MAX_TOTAL_PRIMED_PIXELS) {
        // Preserve assets in the active compile; otherwise replace the oldest
        // speculative image so the budget follows navigation between pages.
        let removed = false
        for (const [oldSource, asset] of assets) {
          if (!asset.primed || used.has(oldSource)) continue
          remove(oldSource, asset)
          removed = true
          break
        }
        if (!removed) return
      }
      create(source, false, pixels)
    },
    dispose() {
      disposed = true
      assets.forEach(({ image }) => {
        image.onload = null
        image.onerror = null
      })
      assets.clear()
    },
  }
}

export interface TextPaintOptions {
  insets?: { left: number; top: number; right: number; bottom: number }
  fill?: string
  stroke?: { color: string; width: number }
  shadow?: { color: string; x: number; y: number; blur: number }
  /** Reject a bitmap if any actual glyph, stroke, or shadow would be clipped. */
  verifyBounds?: boolean
}

export function paintText(
  node: Text,
  bounds: DOMRect,
  style: CSSStyleDeclaration,
  ratio: number,
  scaleX: number,
  scaleY: number,
  options: TextPaintOptions = {}
): HTMLCanvasElement {
  const width = bounds.width / scaleX,
    height = bounds.height / scaleY
  const insets = options.insets ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((width + insets.left + insets.right) * ratio))
  canvas.height = Math.max(1, Math.ceil((height + insets.top + insets.bottom) * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Text canvas unavailable')
  context.scale(ratio, ratio)
  if (insets.left || insets.top) context.translate(insets.left, insets.top)
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  context.fillStyle = options.fill ?? style.color
  if (options.stroke) {
    context.strokeStyle = options.stroke.color
    context.lineWidth = options.stroke.width
  }
  if (options.shadow) {
    context.shadowColor = options.shadow.color
    // Shadow offsets and blur are measured in backing-store pixels and are
    // not transformed with the text coordinates by Canvas 2D.
    context.shadowOffsetX = options.shadow.x * ratio
    context.shadowOffsetY = options.shadow.y * ratio
    context.shadowBlur = options.shadow.blur * ratio
  }
  context.textBaseline = 'alphabetic'
  if ('letterSpacing' in context)
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
  const metrics = context.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  const lines: { x: number; y: number; text: string }[] = []
  const range = document.createRange()
  let index = 0
  for (const character of node.data) {
    range.setStart(node, index)
    index += character.length
    range.setEnd(node, index)
    const glyph = range.getBoundingClientRect()
    if (!glyph.width || !glyph.height) continue
    const previous = lines[lines.length - 1]
    if (previous && Math.abs(previous.y - glyph.top) < 1) previous.text += character
    else lines.push({ x: glyph.left, y: glyph.top, text: character })
  }
  for (const line of lines) {
    const text =
      style.textTransform === 'uppercase'
        ? line.text.toUpperCase()
        : style.textTransform === 'lowercase'
          ? line.text.toLowerCase()
          : line.text
    const x = (line.x - bounds.left) / scaleX,
      y = (line.y - bounds.top) / scaleY + ascent
    if (options.verifyBounds) {
      const ink = context.measureText(text)
      const values = [
        ink.actualBoundingBoxLeft,
        ink.actualBoundingBoxRight,
        ink.actualBoundingBoxAscent,
        ink.actualBoundingBoxDescent,
      ]
      if (!values.every(Number.isFinite)) throw new Error('Text ink bounds unavailable')
      const stroke = (options.stroke?.width ?? 0) / 2
      const left = x - ink.actualBoundingBoxLeft - stroke
      const right = x + ink.actualBoundingBoxRight + stroke
      const top = y - ink.actualBoundingBoxAscent - stroke
      const bottom = y + ink.actualBoundingBoxDescent + stroke
      const shadow = options.shadow
      const halo = shadow ? shadow.blur * 2 : 0
      const minX = Math.min(left, shadow ? left + shadow.x - halo : left)
      const maxX = Math.max(right, shadow ? right + shadow.x + halo : right)
      const minY = Math.min(top, shadow ? top + shadow.y - halo : top)
      const maxY = Math.max(bottom, shadow ? bottom + shadow.y + halo : bottom)
      const antialias = 1 / ratio
      if (
        minX < -insets.left + antialias ||
        maxX > width + insets.right - antialias ||
        minY < -insets.top + antialias ||
        maxY > height + insets.bottom - antialias
      )
        throw new Error('Text effect exceeds the bitmap bounds')
    }
    context.fillText(text, x, y)
    if (options.stroke) context.strokeText(text, x, y)
    if (style.textDecorationLine.includes('underline')) {
      context.fillRect(
        x,
        y + Math.max(1, Number.parseFloat(style.fontSize) * 0.08),
        context.measureText(text).width,
        Math.max(1, Number.parseFloat(style.fontSize) / 16)
      )
    }
    if (style.textDecorationLine.includes('line-through')) {
      context.fillRect(
        x,
        y - Number.parseFloat(style.fontSize) * 0.3,
        context.measureText(text).width,
        Math.max(1, Number.parseFloat(style.fontSize) / 16)
      )
    }
  }
  return canvas
}

export function paintImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  ratio: number,
  style: CSSStyleDeclaration,
  issues: Set<string>
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * ratio))
  canvas.height = Math.max(1, Math.ceil(height * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image canvas unavailable')
  context.scale(ratio, ratio)
  const left =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.borderLeftWidth) || 0)
  const top =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.borderTopWidth) || 0)
  const right =
    (Number.parseFloat(style.paddingRight) || 0) + (Number.parseFloat(style.borderRightWidth) || 0)
  const bottom =
    (Number.parseFloat(style.paddingBottom) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0)
  const radii = boxRadii(style, width, height).map(
    ([x, y], index) =>
      [
        Math.max(0, x - (index === 0 || index === 3 ? left : right)),
        Math.max(0, y - (index < 2 ? top : bottom)),
      ] satisfies readonly [number, number]
  )
  width = Math.max(0, width - left - right)
  height = Math.max(0, height - top - bottom)
  if (!width || !height) return canvas
  context.translate(left, top)
  roundedPath(context, width, height, radii)
  context.clip()
  let drawWidth = width,
    drawHeight = height
  const intrinsicWidth = image.naturalWidth || image.width,
    intrinsicHeight = image.naturalHeight || image.height
  if (style.objectFit !== 'fill' && intrinsicWidth && intrinsicHeight) {
    const contain = Math.min(width / intrinsicWidth, height / intrinsicHeight)
    const scale =
      style.objectFit === 'cover'
        ? Math.max(width / intrinsicWidth, height / intrinsicHeight)
        : style.objectFit === 'none'
          ? 1
          : style.objectFit === 'scale-down'
            ? Math.min(1, contain)
            : contain
    drawWidth = intrinsicWidth * scale
    drawHeight = intrinsicHeight * scale
  }
  const position = style.objectPosition.split(/\s+/)
  if (position.length > 2) issues.add('Four-value object-position is not supported')
  const x = positionValue(position[0] ?? '50%', width - drawWidth)
  const y = positionValue(position[1] ?? '50%', height - drawHeight)
  context.drawImage(image, x, y, drawWidth, drawHeight)
  // Check once at rasterization time. A tainted texture must not hide the HTML.
  try {
    context.getImageData(0, 0, 1, 1)
  } catch {
    issues.add('Cross-origin image requires CORS permission')
  }
  return canvas
}

export function serializeSvg(
  svg: SVGSVGElement,
  width: number,
  height: number,
  issues: Set<string>
): string {
  const clone = svg.cloneNode(true)
  if (!(clone instanceof SVGSVGElement)) throw new Error('Cannot clone SVG')
  if (clone.querySelector('animate, animateTransform, animateMotion, set'))
    issues.add('SVG SMIL animation requires native HTML rendering')
  if (clone.querySelector('foreignObject, image'))
    issues.add('SVG foreignObject and embedded image sources require native HTML rendering')
  const originals = [svg, ...Array.from(svg.querySelectorAll('*'))]
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))]
  originals.forEach((element, index) => {
    const copy = copies[index]
    if (!copy) return
    const style = getComputedStyle(element)
    for (const name of [
      'color',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'vector-effect',
      'fill-opacity',
      'stroke-opacity',
      'font-family',
      'font-size',
      'font-weight',
      'visibility',
    ]) {
      const value = style.getPropertyValue(name)
      if (value) copy.setAttribute(name, value)
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (attribute.name.startsWith('on')) copy.removeAttribute(attribute.name)
    }
  })
  // The outer SVG's DOM positioning is already represented by the scene rect.
  // Keeping it in the image document can move the graphic outside its own viewport.
  clone.removeAttribute('style')
  clone.removeAttribute('transform')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.style.display = 'block'
  clone.style.position = 'static'
  clone.style.overflow = 'hidden'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  for (const use of Array.from(clone.querySelectorAll('use'))) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? ''
    if (
      !href.startsWith('#') ||
      !Array.from(clone.querySelectorAll('[id]')).some((element) => `#${element.id}` === href)
    )
      issues.add('External SVG use references require native HTML rendering')
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
}

/** A none-aligned viewBox can resize by stretching its existing texture. */
export function canStretchSvg(svg: SVGSVGElement, style: CSSStyleDeclaration): boolean {
  const viewBox = svg.viewBox.baseVal
  const aspect = svg.preserveAspectRatio.baseVal
  if (
    !Number.isFinite(viewBox.width) ||
    !Number.isFinite(viewBox.height) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0 ||
    aspect.align !== aspect.SVG_PRESERVEASPECTRATIO_NONE ||
    style.objectFit !== 'fill'
  )
    return false
  // These decorations use CSS pixels rather than the viewBox coordinate space.
  // Stretching their bitmap would change their thickness or position.
  const fixedLengths = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth,
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
  if (
    fixedLengths.some((value) => value.split(/\s+/).some((part) => Number.parseFloat(part) > 0))
  ) {
    return false
  }
  return ![svg, ...Array.from(svg.querySelectorAll('*'))].some(
    (element) => getComputedStyle(element).vectorEffect === 'non-scaling-stroke'
  )
}

export function paintControlText(
  value: string,
  width: number,
  height: number,
  ratio: number,
  style: CSSStyleDeclaration,
  multiline: boolean
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * ratio))
  canvas.height = Math.max(1, Math.ceil(height * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Control text canvas unavailable')
  context.scale(ratio, ratio)
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  context.fillStyle = style.color
  context.textBaseline = 'alphabetic'
  if ('letterSpacing' in context)
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
  const metrics = context.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
  const lines: string[] = []
  for (const paragraph of value.split('\n')) {
    if (!multiline) {
      lines.push(paragraph)
      break
    }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && context.measureText(line + word).width > width) {
        lines.push(line)
        line = word.trimStart()
      } else line += word
    }
    lines.push(line)
  }
  const offset = multiline
    ? (lineHeight - ascent - descent) / 2 + ascent
    : (height - ascent - descent) / 2 + ascent
  lines.forEach((line, index) => {
    const lineWidth = context.measureText(line).width
    const x =
      style.textAlign === 'center'
        ? (width - lineWidth) / 2
        : style.textAlign === 'right' || style.textAlign === 'end'
          ? width - lineWidth
          : 0
    context.fillText(line, x, offset + index * lineHeight)
  })
  return canvas
}

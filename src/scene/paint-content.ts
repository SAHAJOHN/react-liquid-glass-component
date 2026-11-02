import { boxRadii, positionValue, roundedPath } from './paint-box'

export interface Asset {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'error'
}
export function createAssetCache(invalidate: () => void) {
  const assets = new Map<string, Asset>()
  let disposed = false
  const used = new Set<string>()
  return {
    begin() {
      used.clear()
    },
    end() {
      for (const [source, asset] of assets) {
        if (used.has(source)) continue
        asset.image.onload = null
        asset.image.onerror = null
        assets.delete(source)
      }
    },
    get(source: string): Asset {
      used.add(source)
      const previous = assets.get(source)
      if (previous) return previous
      const image = new Image()
      const asset: Asset = { image, status: 'loading' }
      image.onload = () => {
        asset.status = 'ready'
        if (!disposed) invalidate()
      }
      image.onerror = () => {
        asset.status = 'error'
        if (!disposed) invalidate()
      }
      if (!source.startsWith('data:') && !source.startsWith('blob:'))
        image.crossOrigin = 'anonymous'
      image.src = source
      assets.set(source, asset)
      return asset
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

export function paintText(
  node: Text,
  bounds: DOMRect,
  style: CSSStyleDeclaration,
  ratio: number,
  scaleX: number,
  scaleY: number
): HTMLCanvasElement {
  const width = bounds.width / scaleX,
    height = bounds.height / scaleY
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * ratio))
  canvas.height = Math.max(1, Math.ceil(height * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Text canvas unavailable')
  context.scale(ratio, ratio)
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  context.fillStyle = style.color
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
    context.fillText(text, x, y)
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

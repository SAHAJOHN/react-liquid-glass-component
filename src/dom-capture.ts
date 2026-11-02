/** A best-effort viewport snapshot; unsupported CSS and protected media may be omitted. */
export async function captureBackdrop(
  root: HTMLElement,
  options: { excludeVideo?: HTMLVideoElement } = {},
): Promise<HTMLCanvasElement> {
  const view = root.ownerDocument.defaultView
  if (!view) throw new Error('Cannot capture a document without a window')
  const excludeVideo = options.excludeVideo
  const documentRoot = root === root.ownerDocument.documentElement || root === root.ownerDocument.body
  if (excludeVideo && (!documentRoot || !root.contains(excludeVideo))) {
    throw new Error('The background video must belong to the captured document')
  }

  const { default: html2canvas } = await import('html2canvas')
  const rect = root.getBoundingClientRect()
  const media = Array.from(root.ownerDocument.querySelectorAll('canvas, video')).filter(
    (element) => element !== excludeVideo && !element.closest('[data-html2canvas-ignore]'),
  )
  const animations = snapshotAnimations(root.ownerDocument, view)
  let videoExcluded = false

  return html2canvas(root, {
    backgroundColor: null,
    allowTaint: false,
    useCORS: true,
    logging: false,
    scale: 1,
    x: documentRoot ? view.scrollX : -rect.left,
    y: documentRoot ? view.scrollY : -rect.top,
    width: view.innerWidth,
    height: view.innerHeight,
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    windowWidth: view.innerWidth,
    windowHeight: view.innerHeight,
    ...(excludeVideo && {
      // Exclude the source before html2canvas clones it into a canvas. The
      // caller only uses this path for a viewport-filling, fixed video.
      ignoreElements: (element: Element) => {
        if (element !== excludeVideo) return false
        videoExcluded = true
        return true
      },
    }),
    onclone: (doc) => {
      if (excludeVideo) {
        if (!videoExcluded) throw new Error('Unable to exclude the background video')
        // The video will be drawn beneath this overlay by the compositor.
        doc.documentElement.style.setProperty('background', 'transparent', 'important')
        doc.body?.style.setProperty('background', 'transparent', 'important')
      }
      for (const snapshot of animations) {
        const clone = doc.querySelector<HTMLElement>(snapshot.selector)
        if (!clone) continue
        clone.style.setProperty('animation', 'none', 'important')
        clone.style.setProperty('transition', 'none', 'important')
        for (const [name, value] of snapshot.properties) {
          clone.style.setProperty(name, value, 'important')
        }
      }

      restoreVideoFrames(media, doc, view)
      normalizeModernColors(doc)
      // Keep surfaces in layout while preventing their contents from being
      // captured, including children that explicitly set visibility: visible.
      doc.querySelectorAll<HTMLElement>('.liquid-glass, .liquid-glass *').forEach((element) => {
        element.style.setProperty('visibility', 'hidden', 'important')
      })
    },
  })
}

interface AnimationSnapshot {
  selector: string
  properties: Array<[string, string]>
}

function snapshotAnimations(doc: Document, view: Window): AnimationSnapshot[] {
  if (typeof doc.getAnimations !== 'function' || typeof KeyframeEffect === 'undefined') return []
  const snapshots: AnimationSnapshot[] = []
  for (const animation of doc.getAnimations()) {
    const effect = animation.effect
    if (!(effect instanceof KeyframeEffect)) continue
    const target = effect.target
    if (!(target instanceof Element)) continue

    const names = new Set<string>()
    for (const frame of effect.getKeyframes()) {
      for (const name of Object.keys(frame)) {
        if (name !== 'offset' && name !== 'computedOffset' && name !== 'easing' && name !== 'composite') {
          names.add(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))
        }
      }
    }
    const computed = view.getComputedStyle(target)
    snapshots.push({
      selector: elementSelector(target),
      properties: Array.from(names, (name) => [name, computed.getPropertyValue(name)]),
    })
  }
  return snapshots
}

function elementSelector(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current.parentElement) {
    const tag = current.localName
    let index = 1
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.localName === tag) index += 1
    }
    parts.unshift(`${tag}:nth-of-type(${index})`)
    current = current.parentElement
  }
  return parts.length ? `html > ${parts.join(' > ')}` : 'html'
}

function normalizeModernColors(doc: Document): void {
  const view = doc.defaultView
  const context = doc.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!view || !context) return

  const properties = [
    'color',
    'background-color',
    'background-image',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'text-decoration-color',
    'text-shadow',
  ]
  const modernColor = /(?:oklch|oklab|lch|lab|color)\([^()]*\)/g
  const cache = new Map<string, string>()
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
    const computed = view.getComputedStyle(element)
    for (const property of properties) {
      const value = computed.getPropertyValue(property)
      if (!value.match(modernColor)) continue
      const converted = value.replace(modernColor, (color) => {
        const previous = cache.get(color)
        if (previous) return previous
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const pixel = context.getImageData(0, 0, 1, 1).data
        const normalized = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${(pixel[3] ?? 255) / 255})`
        cache.set(color, normalized)
        return normalized
      })
      element.style.setProperty(property, converted, 'important')
    }
  }
}

function restoreVideoFrames(media: Element[], clone: Document, view: Window): void {
  // html2canvas replaces each video with a canvas, dropping its CSS and
  // stretching the frame. Pair only when the clone has the expected media
  // count; otherwise leave html2canvas's own snapshot untouched.
  const canvases = clone.querySelectorAll<HTMLCanvasElement>('canvas')
  if (canvases.length !== media.length) return

  media.forEach((source, index) => {
    const canvas = canvases[index]
    if (!(source instanceof HTMLVideoElement) || !canvas || source.readyState < 2) return
    const context = canvas.getContext('2d')
    if (!context || !source.videoWidth || !source.videoHeight || !canvas.width || !canvas.height) return

    const style = view.getComputedStyle(source)
    for (const name of Array.from(style)) {
      canvas.style.setProperty(name, style.getPropertyValue(name), style.getPropertyPriority(name))
    }
    canvas.style.setProperty('animation', 'none', 'important')
    canvas.style.setProperty('transition', 'none', 'important')

    const width = canvas.width
    const height = canvas.height
    let scaleX = width / source.videoWidth
    let scaleY = height / source.videoHeight
    if (style.objectFit !== 'fill') {
      const scale = style.objectFit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
      const fitted = style.objectFit === 'none' ? 1 : style.objectFit === 'scale-down' ? Math.min(1, scale) : scale
      scaleX = fitted
      scaleY = fitted
    }
    const drawWidth = source.videoWidth * scaleX
    const drawHeight = source.videoHeight * scaleY
    const positions = style.objectPosition.split(/\s+/)
    const x = positionOffset(positions[0], width - drawWidth)
    const y = positionOffset(positions[1], height - drawHeight)

    try {
      context.clearRect(0, 0, width, height)
      context.drawImage(source, x, y, drawWidth, drawHeight)
      // Never return a tainted canvas to the WebGL upload path.
      context.getImageData(0, 0, 1, 1)
    } catch {
      canvas.width = width
    }
  })
}

function positionOffset(position: string | undefined, available: number): number {
  if (!position || position === 'center') return available / 2
  if (position === 'left' || position === 'top') return 0
  if (position === 'right' || position === 'bottom') return available
  const value = Number.parseFloat(position)
  if (!Number.isFinite(value)) return available / 2
  return position.endsWith('%') ? (available * value) / 100 : value
}

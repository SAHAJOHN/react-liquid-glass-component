import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import * as paintContent from '../scene/paint-content'
import type * as PaintBoxModule from '../scene/paint-box'
import type { SceneFrame, SceneRect } from '../scene/types'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame: SceneFrame = { width: 400, height: 800, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const region: SceneRect = { x: 50, y: 300, width: 250, height: 150 }

function fixture(kind: 'img' | 'canvas' | 'video') {
  const root = document.createElement('main')
  const media = document.createElement(kind)
  if (media instanceof HTMLImageElement) media.src = '/example.png'
  if (media instanceof HTMLCanvasElement) {
    media.width = 50
    media.height = 40
  }
  root.append(media)
  const defaults: Record<string, string> = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    position: 'static',
    transform: 'none',
    filter: 'none',
    backdropFilter: 'none',
    boxShadow: 'none',
    textShadow: 'none',
    borderImageSource: 'none',
    backgroundBlendMode: 'normal',
    perspective: 'none',
    listStyleType: 'none',
    clipPath: 'none',
    maskImage: 'none',
    mixBlendMode: 'normal',
    backgroundClip: 'border-box',
    backgroundAttachment: 'scroll',
    writingMode: 'horizontal-tb',
    zIndex: 'auto',
    isolation: 'auto',
    contain: 'none',
    willChange: 'auto',
    overflowX: 'visible',
    overflowY: 'visible',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
    objectFit: 'fill',
    objectPosition: '50% 50%',
  }
  function style() {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries(defaults))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    return result
  }
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, style()],
    [media, style()],
  ])
  const pseudo = style()
  Object.defineProperty(pseudo, 'content', { value: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const result = styles.get(element)
    if (!result) throw new Error('Unexpected element in fixture')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  const bounds = vi
    .spyOn(media, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 20, 50, 40))
  const pendingImage = document.createElement('img')
  const imageConstructor = vi.fn(function Image() {
    return pendingImage
  })
  vi.stubGlobal('Image', imageConstructor)
  vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
  const paintImage = vi
    .spyOn(paintContent, 'paintImage')
    .mockReturnValue(document.createElement('canvas'))
  const compiler = createSceneCompiler(() => {})
  return {
    root,
    media,
    bounds,
    styles,
    style,
    pendingImage,
    imageConstructor,
    paintImage,
    compiler,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('off-region media culling', () => {
  it('skips rasterizing a decoded image outside the region and draws the same image on entry', () => {
    const { root, media, bounds, paintImage, compiler } = fixture('img')
    Object.defineProperties(media, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 50 },
      naturalHeight: { configurable: true, value: 40 },
    })
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(paintImage).not.toHaveBeenCalled()
    expect(outside.samplingWatches).toContainEqual({ element: media, relation: 'outside' })
    expect(outside.scene.items).toHaveLength(0)

    bounds.mockReturnValue(new DOMRect(100, 310, 50, 40))
    const inside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(inside.issues).toEqual([])
    expect(paintImage).toHaveBeenCalledOnce()
    expect(paintImage.mock.calls[0]?.[0]).toBe(media)
    expect(inside.scene.items.some((item) => item.kind === 'sprite')).toBe(true)
    compiler.dispose()
  })

  it('warms an unavailable cross-origin image outside, preserving its CORS error on entry', () => {
    const { root, media, bounds, pendingImage, imageConstructor, paintImage, compiler } =
      fixture('img')
    if (!(media instanceof HTMLImageElement)) throw new Error('Expected image')
    media.src = 'https://cdn.example.test/image.png'
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).toEqual([])
    expect(imageConstructor).toHaveBeenCalledOnce()
    expect(pendingImage.crossOrigin).toBe('anonymous')
    expect(paintImage).not.toHaveBeenCalled()
    pendingImage.dispatchEvent(new Event('error'))
    bounds.mockReturnValue(new DOMRect(100, 310, 50, 40))
    const inside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(inside.issues).toContain('Image could not be read; check its URL and CORS permission')
    expect(paintImage).not.toHaveBeenCalled()
    compiler.dispose()
  })

  it.each(['loading', 'ready'] as const)(
    'warms a distant image and waits for the DOM image when the copy is %s on entry',
    (statusOnEntry) => {
      const { root, media, bounds, pendingImage, imageConstructor, paintImage, compiler } =
        fixture('img')
      if (!(media instanceof HTMLImageElement)) throw new Error('Expected image')
      media.src = 'https://cdn.example.test/distant.png'

      // The warm margin is 1.5 times the longest viewport dimension: 1200px.
      // The sampling region ends at y=450, so this image starts beyond y=1650.
      bounds.mockReturnValue(new DOMRect(100, 1700, 50, 40))
      const distant = compiler.compile(root, new Map(), frame, 'white', region)
      expect(distant.issues).toEqual([])
      expect(distant.samplingWatches).toContainEqual({ element: media, relation: 'outside' })
      expect(imageConstructor).not.toHaveBeenCalled()
      expect(pendingImage.hasAttribute('src')).toBe(false)
      expect(paintImage).not.toHaveBeenCalled()

      // This is outside the optical region, but within its warm margin.
      bounds.mockReturnValue(new DOMRect(100, 1600, 50, 40))
      const near = compiler.compile(root, new Map(), frame, 'white', region)
      expect(near.issues).toEqual([])
      expect(near.samplingWatches).toContainEqual({ element: media, relation: 'outside' })
      expect(imageConstructor).toHaveBeenCalledOnce()
      expect(pendingImage.src).toBe(media.src)
      expect(pendingImage.crossOrigin).toBe('anonymous')
      expect(paintImage).not.toHaveBeenCalled()

      if (statusOnEntry === 'ready') pendingImage.dispatchEvent(new Event('load'))
      bounds.mockReturnValue(new DOMRect(100, 310, 50, 40))
      const entering = compiler.compile(root, new Map(), frame, 'white', region)
      expect(imageConstructor).toHaveBeenCalledOnce()
      expect(entering.issues).toEqual([])
      expect(paintImage).not.toHaveBeenCalled()
      if (statusOnEntry === 'loading') {
        pendingImage.dispatchEvent(new Event('load'))
      }
      Object.defineProperties(media, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 50 },
        naturalHeight: { configurable: true, value: 40 },
      })
      const ready = compiler.compile(root, new Map(), frame, 'white', region)
      expect(ready.issues).toEqual([])
      expect(imageConstructor).toHaveBeenCalledOnce()
      expect(paintImage).toHaveBeenCalledOnce()
      expect(paintImage.mock.calls[0]?.[0]).toBe(pendingImage)
      compiler.dispose()
    }
  )

  it.each(['canvas', 'video'] as const)(
    'omits %s outside but includes its original live source when it enters',
    (kind) => {
      const { root, media, bounds, compiler } = fixture(kind)
      const outside = compiler.compile(root, new Map(), frame, 'white', region)
      expect(outside.media).not.toContain(media)
      expect(outside.scene.items.some((item) => item.kind === 'media')).toBe(false)
      expect(outside.samplingWatches).toContainEqual({ element: media, relation: 'outside' })

      bounds.mockReturnValue(new DOMRect(100, 310, 50, 40))
      const inside = compiler.compile(root, new Map(), frame, 'white', region)
      expect(inside.media).toContain(media)
      expect(inside.scene.items).toContainEqual(
        expect.objectContaining({ kind: 'media', source: media })
      )
      compiler.dispose()
    }
  )

  it('retains media outside the pane when a reachable backdrop blur samples its halo', () => {
    const { root, media, bounds, styles, style, compiler } = fixture('canvas')
    bounds.mockReturnValue(new DOMRect(75, 0, 20, 5))
    const layer = document.createElement('div')
    const layerStyle = style()
    layerStyle.backdropFilter = 'blur(10px)'
    styles.set(layer, layerStyle)
    root.append(layer)
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const pane = { x: 50, y: 20, width: 100, height: 50 }
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.media).toContain(media)
    expect(result.scene.items).toContainEqual(
      expect.objectContaining({ kind: 'media', source: media })
    )
    compiler.dispose()
  })

  it('does not cull media without a valid sampling region', () => {
    const { root, media, compiler } = fixture('canvas')
    expect(compiler.compile(root, new Map(), frame, 'white').media).toContain(media)
    expect(
      compiler.compile(root, new Map(), frame, 'white', { ...region, width: NaN }).media
    ).toContain(media)
    compiler.dispose()
  })

  it('preserves an image shadow even when its replaced content is outside the region', () => {
    const { root, media, styles, compiler } = fixture('img')
    const imageStyle = styles.get(media)
    if (!imageStyle) throw new Error('Missing image style')
    imageStyle.boxShadow = 'rgb(0, 0, 0) 0px 3px 8px'
    const bitmap = document.createElement('canvas')
    vi.mocked(paintBoxShadows).mockReturnValue({
      status: 'ready',
      outer: { bitmap, offsetX: -10, offsetY: -10, width: 70, height: 60 },
    })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.scene.items).toContainEqual(expect.objectContaining({ kind: 'sprite', bitmap }))
    compiler.dispose()
  })
})

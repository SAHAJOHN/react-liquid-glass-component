import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import * as paintContent from '../scene/paint-content'
import * as paintLucideModule from '../scene/paint-lucide'
import type * as PaintBoxModule from '../scene/paint-box'
import type { SceneFrame, SceneRect } from '../scene/types'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => () => [0, 0, 0, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame: SceneFrame = { scrollX: 9, scrollY: 100, width: 400, height: 800, pixelRatio: 2 }
const region: SceneRect = { x: 50, y: 300, width: 250, height: 150 }

function fixture() {
  const root = document.createElement('div')
  const image = document.createElement('img')
  image.src = '/example.png'
  root.append(image)
  const defaults = {
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
    backgroundColor: 'white',
    backgroundImage: 'none',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
    getPropertyValue: () => '',
  }
  const makeStyle = () => {
    const style = document.createElement('div').style
    for (const [property, value] of Object.entries(defaults))
      Object.defineProperty(style, property, { value, configurable: true, writable: true })
    return style
  }
  const rootStyle = makeStyle()
  const imageStyle = makeStyle()
  const pseudoStyle = makeStyle()
  Object.defineProperty(pseudoStyle, 'content', { value: 'none' })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  const imageRect = vi.spyOn(image, 'getBoundingClientRect')
  imageRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    return element === root ? rootStyle : imageStyle
  })
  const loadingImage = document.createElement('img')
  const imageConstructor = vi.fn(function Image() {
    return loadingImage
  })
  vi.stubGlobal('Image', imageConstructor)
  vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
  const paint = vi
    .spyOn(paintContent, 'paintImage')
    .mockReturnValue(document.createElement('canvas'))
  const compiler = createSceneCompiler(() => {})
  return {
    root,
    rootStyle,
    image,
    imageRect,
    imageStyle,
    loadingImage,
    imageConstructor,
    paint,
    compiler,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('off-region image deferral', () => {
  it('starts loading outside the region and reports pending as soon as the image enters', () => {
    const { root, image, imageRect, loadingImage, imageConstructor, paint, compiler } = fixture()
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    expect(outside.samplingWatches).toEqual([{ element: image, relation: 'outside' }])
    expect(imageConstructor).toHaveBeenCalledOnce()
    expect(paint).not.toHaveBeenCalled()

    // The next compilation reflects a scroll: getBoundingClientRect returns the
    // new viewport position, while the scene stores this image in document space.
    imageRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), { ...frame, scrollY: 400 }, 'white', region)
    expect(inside.issues).toContain('Image is loading')
    expect(inside.samplingWatches).toHaveLength(1)
    expect(inside.samplingWatches).toEqual([{ element: image, relation: 'inside' }])
    expect(imageConstructor).toHaveBeenCalledOnce()

    loadingImage.dispatchEvent(new Event('load'))
    const ready = compiler.compile(root, new Map(), { ...frame, scrollY: 400 }, 'white', region)
    expect(ready.issues).toEqual([])
    expect(ready.samplingWatches).toHaveLength(0)
    expect(ready.samplingWatches).toEqual([])
    expect(paint).toHaveBeenCalledOnce()
    compiler.dispose()
  })

  it('uses viewport coordinates for fixed images even when the document is scrolled', () => {
    const { root, imageRect, imageStyle, compiler } = fixture()
    imageStyle.position = 'fixed'
    imageRect.mockReturnValue(new DOMRect(100, 320, 50, 50))
    const inside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(inside.issues).toContain('Image is loading')
    expect(inside.samplingWatches).toHaveLength(1)
    imageRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    const outside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    compiler.dispose()
  })

  it('uses viewport bounds for a fixed image inside a transformed ancestor', () => {
    const { root, rootStyle, imageRect, imageStyle, compiler } = fixture()
    rootStyle.transform = 'matrix(2, 0, 0, 2, 0, 0)'
    imageStyle.position = 'fixed'
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        is2D = true
        a = 2
        b = 0
        c = 0
        d = 2
      }
    )
    imageRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(inside.issues).toContain('Image is loading')
    expect(inside.samplingWatches).toHaveLength(1)
    imageRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    const outside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    compiler.dispose()
  })

  it('does not defer touching pixels, absent regions or invalid regions', () => {
    const { root, imageRect, compiler } = fixture()
    imageRect.mockReturnValue(new DOMRect(100, 250, 50, 50))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      'Image is loading'
    )
    // Raster safety keeps a one-pixel gap at the region boundary.
    imageRect.mockReturnValue(new DOMRect(100, 249, 50, 50))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      'Image is loading'
    )
    imageRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain('Image is loading')
    expect(
      compiler.compile(root, new Map(), frame, 'white', { ...region, width: NaN }).issues
    ).toContain('Image is loading')
    expect(
      compiler.compile(root, new Map(), { ...frame, scrollY: Infinity }, 'white', region).issues
    ).toContain('Image is loading')
    compiler.dispose()
  })

  it('defers a failed off-region image but reports the error when it enters', () => {
    const { root, imageRect, loadingImage, compiler } = fixture()
    compiler.compile(root, new Map(), frame, 'white', region)
    loadingImage.dispatchEvent(new Event('error'))
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    imageRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(inside.issues).toContain('Image could not be read; check its URL and CORS permission')
    expect(inside.samplingWatches).toHaveLength(1)
    imageRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    const movedOut = compiler.compile(root, new Map(), frame, 'white', region)
    expect(movedOut.issues).toEqual([])
    expect(movedOut.samplingWatches).toHaveLength(1)
    compiler.dispose()
  })

  it('defers a tainted DOM image retry only while it is outside the region', () => {
    const { root, image, imageRect, loadingImage, paint, compiler } = fixture()
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 40 },
    })
    paint.mockImplementation((source, _width, _height, _ratio, _style, issues) => {
      if (source === image) issues.add('Cross-origin image requires CORS permission')
      return document.createElement('canvas')
    })
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)

    imageRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(inside.issues).toContain('Image is loading')
    expect(inside.samplingWatches).toHaveLength(1)
    loadingImage.dispatchEvent(new Event('error'))
    const error = compiler.compile(root, new Map(), frame, 'white', region)
    expect(error.issues).toContain('Image could not be read; check its URL and CORS permission')
    compiler.dispose()
  })

  it('still paints image box and shadow and retains unsupported CSS errors outside the region', () => {
    const { root, imageStyle, compiler } = fixture()
    imageStyle.filter = 'blur(2px)'
    imageStyle.boxShadow = 'rgb(0, 0, 0) 0px 3px 8px'
    const shadow = {
      bitmap: document.createElement('canvas'),
      offsetX: -10,
      offsetY: -5,
      width: 70,
      height: 60,
    }
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer: shadow })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain('CSS filters outside LiquidGlass require native HTML rendering')
    expect(result.samplingWatches).toHaveLength(1)
    expect(
      result.scene.items.some((item) => item.kind === 'sprite' && item.bitmap === shadow.bitmap)
    ).toBe(true)
    // Root and the image's own background box are still rendered.
    expect(result.scene.items.filter((item) => item.kind === 'sprite')).toHaveLength(3)
    compiler.dispose()
  })
})

describe('off-region SVG asset deferral', () => {
  function svgFixture() {
    const result = fixture()
    result.image.remove()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 50 50')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M0 0 L50 50')
    svg.append(path)
    result.root.append(svg)
    const svgRect = vi.spyOn(svg, 'getBoundingClientRect')
    svgRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    result.imageStyle.overflowX = 'hidden'
    result.imageStyle.overflowY = 'hidden'
    vi.spyOn(paintContent, 'canStretchSvg').mockReturnValue(false)
    const serialize = vi.spyOn(paintContent, 'serializeSvg')
    return { ...result, svg, svgRect, serialize }
  }

  it('uses the synchronous icon without hiding SVG validation issues', () => {
    const { root, svg, imageConstructor, compiler } = svgFixture()
    const bitmap = document.createElement('canvas')
    const fastPath = vi.spyOn(paintLucideModule, 'paintLucide').mockReturnValue({
      status: 'ready',
      bitmap,
    })
    svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'animate'))
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(fastPath).toHaveBeenCalledOnce()
    expect(imageConstructor).not.toHaveBeenCalled()
    expect(result.scene.items).toContainEqual(expect.objectContaining({ kind: 'sprite', bitmap }))
    expect(result.issues).toContain('SVG SMIL animation requires native HTML rendering')
    compiler.dispose()
  })

  it('still serializes and starts loading a clipped SVG outside the region, then reports loading on entry', () => {
    const { root, svgRect, imageConstructor, loadingImage, serialize, paint, compiler } =
      svgFixture()
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(serialize).toHaveBeenCalledOnce()
    expect(imageConstructor).toHaveBeenCalledOnce()
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    expect(paint).not.toHaveBeenCalled()

    svgRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), { ...frame, scrollY: 400 }, 'white', region)
    expect(inside.issues).toContain('SVG is loading')
    expect(inside.samplingWatches).toHaveLength(1)
    loadingImage.dispatchEvent(new Event('load'))
    const ready = compiler.compile(root, new Map(), { ...frame, scrollY: 400 }, 'white', region)
    expect(ready.issues).toEqual([])
    expect(ready.samplingWatches).toHaveLength(0)
    expect(paint).toHaveBeenCalledOnce()
    compiler.dispose()
  })

  it('keeps clipped SVGs that touch the region and always waits when no valid region is supplied', () => {
    const { root, svgRect, compiler } = svgFixture()
    svgRect.mockReturnValue(new DOMRect(100, 250, 50, 50))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      'SVG is loading'
    )
    svgRect.mockReturnValue(new DOMRect(100, 249, 50, 50))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      'SVG is loading'
    )
    svgRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    const standard = compiler.compile(root, new Map(), frame, 'white')
    expect(standard.issues).toContain('SVG is loading')
    expect(standard.samplingWatches).toHaveLength(0)
    expect(standard.samplingWatches).toEqual([])
    expect(
      compiler.compile(root, new Map(), frame, 'white', { ...region, width: NaN }).issues
    ).toContain('SVG is loading')
    compiler.dispose()
  })

  it('does not defer SVGs with visible or ambiguous overflow on either axis', () => {
    const { root, imageStyle, compiler } = svgFixture()
    for (const [x, y] of [
      ['visible', 'hidden'],
      ['hidden', 'visible'],
      ['', 'hidden'],
      ['clip', 'auto'],
    ] as const) {
      imageStyle.overflowX = x
      imageStyle.overflowY = y
      const result = compiler.compile(root, new Map(), frame, 'white', region)
      expect(result.issues).toContain('SVG is loading')
      expect(result.samplingWatches).toEqual([])
    }
    compiler.dispose()
  })

  it('does not defer SVG rasters with effects whose extent is not proven', () => {
    const { root, imageStyle, compiler } = svgFixture()
    imageStyle.filter = 'blur(20px)'
    let result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain('CSS filters outside LiquidGlass require native HTML rendering')
    expect(result.issues).toContain('SVG is loading')

    imageStyle.filter = 'none'
    Object.defineProperty(imageStyle, 'outlineStyle', {
      value: 'solid',
      writable: true,
      configurable: true,
    })
    result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain('SVG is loading')

    imageStyle.outlineStyle = 'none'
    imageStyle.boxShadow = 'red 0px 0px 20px'
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'unsupported', reason: 'unknown shadow' })
    result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain('CSS box shadow: unknown shadow')
    expect(result.issues).toContain('SVG is loading')
    compiler.dispose()
  })

  it('never hides unsupported SVG features while the raster is deferred', () => {
    const { root, svg, serialize, compiler } = svgFixture()
    for (const tag of ['animate', 'foreignObject', 'image']) {
      svg.append(document.createElementNS('http://www.w3.org/2000/svg', tag))
    }
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', 'https://untrusted.example/remote.svg#icon')
    svg.append(use)
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(serialize).toHaveBeenCalledOnce()
    expect(result.issues).toContain('SVG SMIL animation requires native HTML rendering')
    expect(result.issues).toContain(
      'SVG foreignObject and embedded image sources require native HTML rendering'
    )
    expect(result.issues).toContain('External SVG use references require native HTML rendering')
    expect(result.issues).not.toContain('SVG is loading')
    expect(result.samplingWatches).toHaveLength(1)
    compiler.dispose()
  })

  it('converts fixed SVG bounds correctly and reports decode errors when the region is entered', () => {
    const { root, imageStyle, svgRect, loadingImage, compiler } = svgFixture()
    imageStyle.position = 'fixed'
    imageStyle.overflowX = 'clip'
    imageStyle.overflowY = 'hidden'
    const outside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toHaveLength(1)
    loadingImage.dispatchEvent(new Event('error'))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toEqual([])
    svgRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    const inside = compiler.compile(root, new Map(), { ...frame, scrollY: 900 }, 'white', region)
    expect(inside.issues).toContain('SVG could not be rendered')
    expect(inside.samplingWatches).toHaveLength(1)
    compiler.dispose()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import type { BoxShadowPaint } from '../scene/paint-shadow'
import type * as PaintBoxModule from '../scene/paint-box'
import * as paintContent from '../scene/paint-content'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => () => [0, 0, 0, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { scrollX: 5, scrollY: 7, width: 400, height: 800, pixelRatio: 2 }
const outer = {
  bitmap: document.createElement('canvas'),
  offsetX: -10,
  offsetY: -5,
  width: 120,
  height: 60,
}
const inset = {
  bitmap: document.createElement('canvas'),
  offsetX: 0,
  offsetY: 0,
  width: 100,
  height: 50,
}

function fixture() {
  const root = document.createElement('div')
  const box = document.createElement('div')
  root.appendChild(box)
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
  const makeStyle = (overrides: Record<string, string>) => {
    const style = document.createElement('div').style
    for (const [property, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(style, property, { value, configurable: true, writable: true })
    return style
  }
  const rootStyle = makeStyle({ overflowX: 'hidden', overflowY: 'hidden' })
  const boxStyle = makeStyle({ boxShadow: 'rgb(0, 0, 0) 0px 3px 8px', color: 'black' })
  const pseudoStyle = makeStyle({ content: 'none' })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200))
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    return element === root ? rootStyle : boxStyle
  })
  return { root, box, rootStyle, boxStyle }
}

afterEach(() => vi.restoreAllMocks())

describe('scene box shadow integration', () => {
  it('paints outer, box and inset in order with ancestor clipping, and caches by style and size', () => {
    const { root, boxStyle } = fixture()
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer, inset })
    const compiler = createSceneCompiler(() => {})
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toEqual([])
    const sprites = result.scene.items.filter((item) => item.kind === 'sprite')
    expect(sprites).toHaveLength(4) // root, outer, box, inset
    expect(sprites[1]).toMatchObject({
      bitmap: outer.bitmap,
      rect: { x: 15, y: 32, width: 120, height: 60 },
      clips: [{ rect: { x: 5, y: 7, width: 300, height: 200 } }],
      opacity: 1,
    })
    expect(sprites[3]).toMatchObject({
      bitmap: inset.bitmap,
      rect: { x: 25, y: 37, width: 100, height: 50 },
    })
    compiler.compile(root, new Map(), frame, 'white')
    expect(paintBoxShadows).toHaveBeenCalledTimes(1)
    boxStyle.borderTopLeftRadius = '12px'
    compiler.compile(root, new Map(), frame, 'white')
    expect(paintBoxShadows).toHaveBeenCalledTimes(2)
    compiler.dispose()
  })

  it('keeps unsupported shadows native and composes safely clipped shadows with opacity', () => {
    const { root, box, rootStyle } = fixture()
    vi.mocked(paintBoxShadows).mockReturnValue({
      status: 'unsupported',
      reason: 'invalid test shadow',
    } satisfies BoxShadowPaint)
    const compiler = createSceneCompiler(() => {})
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(
      'CSS box shadow: invalid test shadow'
    )
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer })
    rootStyle.opacity = '0.5'
    const freshCompiler = createSceneCompiler(() => {})
    const result = freshCompiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toEqual([])
    const group = result.scene.items.find((item) => item.kind === 'opacity-group')
    if (!group || group.kind !== 'opacity-group') throw new Error('Expected GPU opacity group')
    expect(group.opacity).toBe(0.5)
    expect(group.items).toHaveLength(3)
    expect(group.items[0]).toMatchObject({ kind: 'sprite', opacity: 1 })
    expect(group.items[1]).toMatchObject({ kind: 'sprite', bitmap: outer.bitmap, opacity: 1 })
    expect(group.items[2]).toMatchObject({ kind: 'sprite', opacity: 1 })
    expect(group.items[1]?.clips).toEqual(group.items[2]?.clips)

    vi.mocked(box.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 100, 50))
    expect(freshCompiler.compile(root, new Map(), frame, 'white').issues).toContain(
      'CSS box shadows with opacity require native HTML rendering'
    )
    compiler.dispose()
    freshCompiler.dispose()
  })

  it('leaves zero-area screen-reader content in HTML without painting it', () => {
    const { root, boxStyle } = fixture()
    boxStyle.clipPath = 'inset(50%)'
    const compiler = createSceneCompiler(() => {})
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toEqual([])
    expect(result.scene.items.filter((item) => item.kind === 'sprite')).toHaveLength(1)
    compiler.dispose()
  })

  it('repaints cached text after fonts finish loading', () => {
    const { root, box } = fixture()
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
    box.append(document.createTextNode('Text'))
    const fonts = new EventTarget()
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    const range = {
      selectNodeContents: vi.fn(),
      getBoundingClientRect: () => new DOMRect(20, 30, 40, 15),
    }
    vi.spyOn(document, 'createRange').mockReturnValue(range as unknown as Range)
    const paint = vi
      .spyOn(paintContent, 'paintText')
      .mockReturnValue(document.createElement('canvas'))
    const invalidate = vi.fn()
    const compiler = createSceneCompiler(invalidate)
    try {
      compiler.compile(root, new Map(), frame, 'white')
      compiler.compile(root, new Map(), frame, 'white')
      expect(paint).toHaveBeenCalledTimes(1)
      fonts.dispatchEvent(new Event('loadingdone'))
      expect(invalidate).toHaveBeenCalledOnce()
      compiler.compile(root, new Map(), frame, 'white')
      expect(paint).toHaveBeenCalledTimes(2)
    } finally {
      compiler.dispose()
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('retries a tainted loaded DOM image through the anonymous asset cache', () => {
    const { root, boxStyle } = fixture()
    boxStyle.boxShadow = 'none'
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
    const image = document.createElement('img')
    image.src = '/redirecting-avatar.jpg'
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 40 },
    })
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 40, 40))
    root.append(image)
    const anonymous = document.createElement('img')
    const OriginalImage = globalThis.Image
    const createImage = vi.fn(function Image() {
      return anonymous
    })
    vi.stubGlobal('Image', createImage)
    const paint = vi
      .spyOn(paintContent, 'paintImage')
      .mockImplementation((source, _width, _height, _ratio, _style, issues) => {
        if (source === image) issues.add('Cross-origin image requires CORS permission')
        return document.createElement('canvas')
      })
    const compiler = createSceneCompiler(() => {})
    try {
      const loading = compiler.compile(root, new Map(), frame, 'white')
      expect(loading.issues).toContain('Image is loading')
      expect(loading.issues).not.toContain('Cross-origin image requires CORS permission')
      expect(anonymous.crossOrigin).toBe('anonymous')
      expect(createImage).toHaveBeenCalledOnce()
      anonymous.dispatchEvent(new Event('load'))
      const ready = compiler.compile(root, new Map(), frame, 'white')
      expect(ready.issues).toEqual([])
      expect(paint).toHaveBeenCalledTimes(2)
      expect(paint.mock.calls[0]?.[0]).toBe(image)
      expect(paint.mock.calls[1]?.[0]).toBe(anonymous)
      compiler.compile(root, new Map(), frame, 'white')
      expect(paint).toHaveBeenCalledTimes(2)
      expect(createImage).toHaveBeenCalledOnce()
    } finally {
      compiler.dispose()
      vi.stubGlobal('Image', OriginalImage)
    }
  })

  it('warms a clean DOM image and reuses it after its element is replaced', () => {
    const { root, boxStyle } = fixture()
    boxStyle.boxShadow = 'none'
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
    const first = document.createElement('img')
    first.crossOrigin = 'anonymous'
    first.src = 'https://cdn.example.test/avatar.jpg'
    Object.defineProperties(first, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 40 },
      naturalHeight: { configurable: true, value: 40 },
    })
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 40, 40))
    root.append(first)
    const warmed = document.createElement('img')
    Object.defineProperties(warmed, {
      naturalWidth: { configurable: true, value: 40 },
      naturalHeight: { configurable: true, value: 40 },
    })
    vi.stubGlobal('Image', function Image() {
      return warmed
    })
    const paint = vi
      .spyOn(paintContent, 'paintImage')
      .mockImplementation(() => document.createElement('canvas'))
    const compiler = createSceneCompiler(() => {})
    try {
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toEqual([])
      expect(paint.mock.calls[0]?.[0]).toBe(first)
      expect(warmed.src).toBe(first.src)
      warmed.dispatchEvent(new Event('load'))
      const next = document.createElement('img')
      next.src = first.src
      vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 40, 40))
      first.replaceWith(next)
      // React may reuse the old element for a different source; cached assets
      // must not hold a reference to that mutable DOM node.
      first.src = '/another-avatar.jpg'
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toEqual([])
      expect(paint).toHaveBeenCalledTimes(1)
      Object.defineProperties(next, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 40 },
        naturalHeight: { configurable: true, value: 40 },
      })
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toEqual([])
      expect(paint.mock.calls[1]?.[0]).toBe(warmed)
    } finally {
      compiler.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('places shadows around a managed glass item', () => {
    const { root, box } = fixture()
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer, inset })
    const compiler = createSceneCompiler(() => {})
    const glasses = new Map([
      [
        box,
        {
          radius: 12,
          displacement: [0, 0, 0] as const,
          blur: 0,
          saturation: 1,
          color: 'white',
          opacity: 1,
        },
      ],
    ])
    const result = compiler.compile(root, glasses, frame, 'white')
    expect(result.issues).toEqual([])
    expect(result.scene.items.map((item) => item.kind)).toEqual([
      'sprite',
      'sprite',
      'glass',
      'sprite',
    ])
    compiler.dispose()
  })
})
